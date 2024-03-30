using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface IProductOptionRepository
{
    Task<ProductOptionModel?> Get(int productOptionId);
    Task<IEnumerable<ProductOptionModel>> GetByProductId(int productId);
}