using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface IProductRepository
{
    Task<ProductModel?> Get(int id);

    Task<IEnumerable<ProductModel>> Get();

    Task<IEnumerable<ProductModel>> GetByCategoryId(int categoryId);
}