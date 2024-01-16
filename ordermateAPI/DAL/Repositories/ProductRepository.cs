using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.DAL.Scripts;

namespace ordermateAPI.DAL.Repositories;

public class ProductRepository : IProductRepository
{
    private readonly IDbContext _dbContext;

    public ProductRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<ProductModel?> Get(int id)
    {
        using var connection = _dbContext.CreateConnection();
        
        ProductModel? product = await connection.QuerySingleOrDefaultAsync<ProductModel>(ProductScripts.GetById, new { id });
        return product;
    }

    public async Task<IEnumerable<ProductModel>> Get()
    {
        using var connection = _dbContext.CreateConnection();
        
        IEnumerable<ProductModel> products = await connection.QueryAsync<ProductModel>(ProductScripts.Get);
        return products;
    }

    public async Task<IEnumerable<ProductModel>> GetByCategoryId(int categoryId)
    {
        using var connection = _dbContext.CreateConnection();

        IEnumerable<ProductModel> products = await connection.QueryAsync<ProductModel>(ProductScripts.GetByCategoryId, new { categoryId });
        return products;
    }
}