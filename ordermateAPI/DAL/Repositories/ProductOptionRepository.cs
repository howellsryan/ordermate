using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Repositories;

public class ProductOptionRepository : IProductOptionRepository
{
    private readonly IDbContext _dbContext;

    public ProductOptionRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }
    
    public async Task<IEnumerable<ProductOptionModel>> GetByProductId(int productId)
    {
        var query = "SELECT * FROM ProductOptions WHERE ProductId = @productId";
        using var connection = _dbContext.CreateConnection();
        
        IEnumerable<ProductOptionModel> productOptions = await connection.QueryAsync<ProductOptionModel>(query, new { productId });
        return productOptions;
    }
}